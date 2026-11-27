// FlowJo track, seq 448 (F2b): the real display transforms.
//
// Per-parameter transforms on the event store: log, the REAL Parks/Moore
// logicle/biexponential (W, T, M, A), arcsinh, Hyperlog. Implemented from
// the published math — never from decompiled FlowJo code, and never the
// flow-fcs crate's biexponential, which F0 proved is arcsinh with the
// width ignored (it diverges up to 0.25 of display scale from true W=0.5
// logicle near zero; docs/flow-fcs-evaluation.md §9).
//
// ── Sources ─────────────────────────────────────────────────────────────
// * logicle + Hyperlog: the GatingML 2.0 definitions (Parks et al. 2006).
//   logicle(x,T,W,M,A) = root(B(y) − x), B(y) = a·e^{b·y} − c·e^{−d·y} − f;
//   hyperlog(x,T,W,M,A) = root(EH(y) − x), EH(y) = a·e^{b·y} + c·y − f.
//   Both share the display-scale convention: the top of scale T maps to
//   display 1, and the zero of the data maps to x1 = (A+W)/(M+A)
//   (B(x1) = EH(x1) = 0 by construction). The Python reference that the
//   goldens come from is ~/workspace/.helix-flowjo/eval/logicle_ref.py
//   (logicle) + make_transform_goldens.py (Hyperlog, per flowCore).
// * FlowJo's "biexponential" IS this logicle: FlowJo's own docs say "one
//   implementation of biexponential is called logicle as presented by
//   Parks, Moore and Roederer", and FlowJo's default display is logicle
//   (T=262144, M=4.5, W=0.5, A=0) — the F0 evaluation's default. There is
//   no separate "biexponential" kind: kind "logicle" with (T, W, M, A) is
//   the FlowJo biex.
// * arcsinh: the Stanford identity y = asinh(x·sinh(M·ln10)/T) /
//   ((M+A)·ln10) + A/(M+A) — exactly logicle at W=0 (F0: 5.6e-17).
// * log: the normalized GatingML logarithmic form on the same (T, M)
//   axis family: y = 1 + (log_base(x) − log_base(T))/M for x > 0; x ≤ 0
//   piles on the axis floor (as FlowJo's log display does).
// * linear: y = x/T.
//
// ── Data transform vs display transform ─────────────────────────────────
// The DATA transform rewrites a stored column in place (the store's
// `applyTransform`, the `flow_apply_transform` Rust command, the MCP
// tool) and the sample node records it in `flowSample.transforms` —
// re-transforming an already-transformed parameter is refused by the MCP
// executor (reload the sample to start from raw values), because the
// store keeps no raw copy. The DISPLAY transform is separate: the viewer
// (`src/flow/viewer.ts`) plots transformed copies and sets Plotly
// tickvals/ticktext from `flowAxisTicks` — it never rewrites the store.
//
// f64 throughout here: the store holds f32, so a stored column rounds the
// result to f32 (~1e-7 relative) — the pin asserts the pure functions at
// 1e-9/1e-12 and the stored column at 1e-6 relative.

import type { FlowTransformRef } from "./sample";
import type { FlowParamStats } from "./store";

/** The transform kinds (the same five `FlowTransformRef` carries). */
export type FlowTransformKind = "log" | "logicle" | "arcsinh" | "hyperlog" | "linear";

/** Kind-specific numbers, as a caller supplies them (all optional —
 *  `resolveTransform` fills the defaults and validates). */
export interface FlowTransformParams {
  /** Top of scale: maps to display 1. Default 262144. */
  T?: number;
  /** Width of the linear region, in decades. Default 0.5 (logicle/Hyperlog). */
  W?: number;
  /** Decades of the logarithmic scale. Default 4.5. */
  M?: number;
  /** Extra negative decades. Default 0. */
  A?: number;
  /** Log base (log kind only). Default 10. */
  base?: number;
  /** Display value non-positive log inputs pile on (log kind only). Default 0. */
  floor?: number;
}

/** A transform with every number filled in and validated. */
export interface ResolvedFlowTransform {
  kind: FlowTransformKind;
  T: number;
  W: number;
  M: number;
  A: number;
  base: number;
  floor: number;
}

const LN10 = Math.LN10;

/** The FlowJo/flowCore default display: T=262144, M=4.5, W=0.5, A=0. */
export const FLOW_TRANSFORM_DEFAULTS = {
  T: 262144,
  W: 0.5,
  M: 4.5,
  A: 0,
  base: 10,
  floor: 0,
} as const;

const finiteNumber = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Transform parameter “${name}” must be a finite number.`);
  }
  return value;
};

/** Fill a kind's defaults and validate the GatingML ranges. Throws with
 *  the offending parameter named — the MCP executor surfaces this. */
export function resolveTransform(
  kind: FlowTransformKind,
  params: FlowTransformParams | Record<string, number> = {},
): ResolvedFlowTransform {
  if (kind !== "log" && kind !== "logicle" && kind !== "arcsinh" && kind !== "hyperlog" && kind !== "linear") {
    throw new Error(`Unknown transform kind “${kind}” — log, logicle, arcsinh, hyperlog or linear.`);
  }
  const p = params as FlowTransformParams;
  const T = p.T === undefined ? FLOW_TRANSFORM_DEFAULTS.T : finiteNumber(p.T, "T");
  const M = p.M === undefined ? FLOW_TRANSFORM_DEFAULTS.M : finiteNumber(p.M, "M");
  const A = p.A === undefined ? FLOW_TRANSFORM_DEFAULTS.A : finiteNumber(p.A, "A");
  const W = p.W === undefined ? FLOW_TRANSFORM_DEFAULTS.W : finiteNumber(p.W, "W");
  const base = p.base === undefined ? FLOW_TRANSFORM_DEFAULTS.base : finiteNumber(p.base, "base");
  const floor = p.floor === undefined ? FLOW_TRANSFORM_DEFAULTS.floor : finiteNumber(p.floor, "floor");
  if (T <= 0) throw new Error(`Transform parameter “T” must be positive (got ${T}).`);
  if (M <= 0) throw new Error(`Transform parameter “M” must be positive (got ${M}).`);
  if (kind === "logicle" || kind === "hyperlog") {
    // GatingML 2.0: W ≤ M/2 and A ∈ [−W, M−2W]; Hyperlog additionally
    // needs W > 0 (its ca divides by w = W/(M+A)).
    if (kind === "hyperlog" && W <= 0) {
      throw new Error(`Hyperlog needs W > 0 (got ${W}) — ca divides by W/(M+A).`);
    }
    if (W < 0 || W > M / 2) {
      throw new Error(`Transform parameter “W” must lie in [0, M/2] = [0, ${M / 2}] (got ${W}).`);
    }
    if (A < -W || A > M - 2 * W) {
      throw new Error(`Transform parameter “A” must lie in [−W, M−2W] = [${-W}, ${M - 2 * W}] (got ${A}).`);
    }
  }
  if (kind === "log" && base <= 1) {
    throw new Error(`Transform parameter “base” must be above 1 (got ${base}).`);
  }
  // arcsinh carries no linear-region width (W is ignored); log and linear
  // carry no W/A — the resolved record keeps the defaults so the wire
  // format is one shape for every kind.
  return { kind, T, W, M, A, base, floor };
}

/** A sample node's transform record, resolved (defaults filled). */
export function transformFromRef(ref: FlowTransformRef): ResolvedFlowTransform {
  return resolveTransform(ref.kind, ref.params ?? {});
}

// ── Logicle (GatingML 2.0) ────────────────────────────────────────────────

interface LogicleCoeffs {
  a: number;
  b: number;
  c: number;
  d: number;
  f: number;
}

/** d solves 2·(ln d − ln b) + w·(d+b) = 0; d ∈ (0, b] for w > 0, d = b
 *  at w = 0. Bisection, mirroring the Python reference exactly. */
function solveLogicleD(b: number, w: number): number {
  if (w <= 0) return b;
  const f = (d: number) => 2 * (Math.log(d) - Math.log(b)) + w * (d + b);
  let lo = 1e-12;
  let hi = b;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((f(lo) < 0) === (f(mid) < 0)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function logicleCoeffs(T: number, W: number, M: number, A: number): LogicleCoeffs {
  const w = W / (M + A);
  const x2 = A / (M + A);
  const x1 = x2 + w;
  const x0 = x2 + 2 * w;
  const b = (M + A) * LN10;
  const d = solveLogicleD(b, w);
  const ca = Math.exp(x0 * (b + d));
  const fa = Math.exp(b * x1) - ca / Math.exp(d * x1);
  const a = T / (Math.exp(b) - fa - ca / Math.exp(d));
  const c = ca * a;
  const f = fa * a;
  return { a, b, c, d, f };
}

const logicleB = (y: number, p: LogicleCoeffs): number =>
  p.a * Math.exp(p.b * y) - p.c * Math.exp(-p.d * y) - p.f;
const logicleDB = (y: number, p: LogicleCoeffs): number =>
  p.a * p.b * Math.exp(p.b * y) + p.c * p.d * Math.exp(-p.d * y);

// ── Hyperlog (GatingML 2.0, flowCore) ─────────────────────────────────────

interface HyperlogCoeffs {
  a: number;
  b: number;
  c: number;
  f: number;
}

function hyperlogCoeffs(T: number, W: number, M: number, A: number): HyperlogCoeffs {
  const w = W / (M + A);
  const x2 = A / (M + A);
  const x1 = x2 + w;
  const x0 = x2 + 2 * w;
  const b = (M + A) * LN10;
  const e0 = Math.exp(b * x0);
  const ca = e0 / w;
  const fa = Math.exp(b * x1) + ca * x1;
  const a = T / (Math.exp(b) + ca - fa);
  const c = ca * a;
  const f = fa * a;
  return { a, b, c, f };
}

const hyperlogEH = (y: number, p: HyperlogCoeffs): number => p.a * Math.exp(p.b * y) + p.c * y - p.f;
const hyperlogDEH = (y: number, p: HyperlogCoeffs): number => p.a * p.b * Math.exp(p.b * y) + p.c;

// ── Root finding (logicle + Hyperlog share it) ────────────────────────────

/** Bracketed Newton on a strictly increasing F with F' > 0: Newton while
 *  it stays inside the bracket, bisection otherwise. The bracket is the
 *  display range [−2, 2], exactly as the Python reference holds it — an
 *  x outside F([−2, 2]) is off the bottom/top of the display and clamps
 *  to the edge (FlowJo piles such events at the axis, it does not extend
 *  it): Hyperlog's negative tail is linear, so a large negative x (e.g.
 *  −100000) is below EH(−2) and returns −2, while logicle's exponential
 *  tail keeps B(−2) far below any realistic x. No bracket expansion —
 *  expanding finds a "true" root the reference (and the display) never
 *  shows, and the two sides would disagree. */
function solveMonotonic(
  forward: (y: number) => number,
  derivative: (y: number) => number,
  x: number,
): number {
  let lo = -2;
  let hi = 2;
  const tol = 1e-12 * Math.max(1, Math.abs(x));
  let y = 0;
  for (let i = 0; i < 100; i++) {
    const f = forward(y) - x;
    if (Math.abs(f) <= tol) return y;
    if (f < 0) lo = y;
    else hi = y;
    const slope = derivative(y);
    const newton = slope > 0 && Number.isFinite(slope) ? y - f / slope : NaN;
    y = Number.isFinite(newton) && newton > lo && newton < hi ? newton : (lo + hi) / 2;
    if (hi - lo < 1e-15) return (lo + hi) / 2;
  }
  return y;
}

// ── Forward / inverse ─────────────────────────────────────────────────────

/** One data value → display units. */
export function applyTransformValue(t: ResolvedFlowTransform, x: number): number {
  switch (t.kind) {
    case "linear":
      return x / t.T;
    case "log":
      return x <= 0 ? t.floor : 1 + (Math.log(x) / Math.log(t.base) - Math.log(t.T) / Math.log(t.base)) / t.M;
    case "arcsinh":
      return Math.asinh((x * Math.sinh(t.M * LN10)) / t.T) / ((t.M + t.A) * LN10) + t.A / (t.M + t.A);
    case "logicle": {
      const p = logicleCoeffs(t.T, t.W, t.M, t.A);
      return solveMonotonic((y) => logicleB(y, p), (y) => logicleDB(y, p), x);
    }
    case "hyperlog": {
      const p = hyperlogCoeffs(t.T, t.W, t.M, t.A);
      return solveMonotonic((y) => hyperlogEH(y, p), (y) => hyperlogDEH(y, p), x);
    }
  }
}

/** One display value → data units (the exact inverse, except log at/below
 *  the floor: every non-positive data value piles there, and so does every
 *  positive value below the bottom decade (x ≤ T·base^{M·(floor−1)} —
 *  8.29 on the defaults) — the inverse of the floor is 0, and the log
 *  transform is only invertible above the pile-up threshold. That is the
 *  log scale's nature, not a bug: FlowJo piles the same events at the
 *  axis bottom. */
export function invertTransformValue(t: ResolvedFlowTransform, y: number): number {
  switch (t.kind) {
    case "linear":
      return y * t.T;
    case "log":
      return y <= t.floor ? 0 : t.T * Math.pow(t.base, t.M * (y - 1));
    case "arcsinh":
      return (t.T * Math.sinh(((t.M + t.A) * LN10 * (y - t.A / (t.M + t.A)))) ) / Math.sinh(t.M * LN10);
    case "logicle": {
      const p = logicleCoeffs(t.T, t.W, t.M, t.A);
      return logicleB(y, p);
    }
    case "hyperlog": {
      const p = hyperlogCoeffs(t.T, t.W, t.M, t.A);
      return hyperlogEH(y, p);
    }
  }
}

/** Apply a resolved transform to a whole column, in place (the store's
 *  `applyTransform` calls this; the Rust side mirrors it). Returns the
 *  before/after stats of the parameter for the caller's summary. */
export function applyTransformToColumn(
  t: ResolvedFlowTransform,
  column: Float32Array,
  name: string,
): { before: FlowParamStats; after: FlowParamStats } {
  const stats = (values: Float32Array): FlowParamStats => {
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      count++;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { name, count, min: count ? min : null, max: count ? max : null, mean: count ? sum / count : null };
  };
  const before = stats(column);
  for (let i = 0; i < column.length; i++) {
    if (Number.isFinite(column[i])) column[i] = applyTransformValue(t, column[i]);
  }
  return { before, after: stats(column) };
}

// ── Axis ticks (display) ──────────────────────────────────────────────────

/** FlowJo-style tick label for a data value: 0, 10, 100, 1k, 10k, … */
export function formatFlowTick(value: number): string {
  if (value === 0) return "0";
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}k`;
  return String(value);
}

/** The standard axis ticks for a transform: the data values 0, 10, 100,
 *  … up to the top of scale T, positioned at their forward-transformed
 *  display values and labelled with the data values. Display only — the
 *  data transform is separate (see the header note). */
export function flowAxisTicks(t: ResolvedFlowTransform): { tickvals: number[]; ticktext: string[] } {
  const dataTicks: number[] = [0];
  for (let v = 10; v < t.T; v *= 10) dataTicks.push(v);
  dataTicks.push(t.T);
  return {
    tickvals: dataTicks.map((v) => applyTransformValue(t, v)),
    ticktext: dataTicks.map(formatFlowTick),
  };
}

// ── Rust command client ───────────────────────────────────────────────────

/** What the `flow_apply_transform` command returns (camelCase wire
 *  format — see the `rename_all = "camelCase"` on the Rust structs). */
export interface FlowTransformResult {
  sampleId: string;
  parameter: string;
  kind: FlowTransformKind;
  eventCount: number;
  before: FlowParamStats;
  after: FlowParamStats;
}

/** Apply a transform to one parameter of a loaded sample, in the Rust
 *  event store, via the Tauri command. The `@tauri-apps/api` import is
 *  dynamic so this module also loads in node (tests) and in plain web
 *  dev, where the command does not exist. Sends the RESOLVED parameters
 *  (canonical, validated) — the Rust side resolves again and validates. */
export async function applyFlowTransform(
  sampleId: string,
  parameter: string,
  transform: FlowTransformRef,
): Promise<FlowTransformResult> {
  const resolved = transformFromRef(transform);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FlowTransformResult>("flow_apply_transform", {
    sample_id: sampleId,
    parameter,
    kind: resolved.kind,
    params: { T: resolved.T, W: resolved.W, M: resolved.M, A: resolved.A, base: resolved.base, floor: resolved.floor },
  });
}
