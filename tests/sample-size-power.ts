/// <reference types="node" />
// Pin tests for seq 207: "Sample size & power" (1.8.3) — the local desktop
// guided tool, per Smit's Nov 22 decision (local, not Cloud).
//
// Every v1 test pins R `pwr` package reference values to 3 decimals, each
// solved once for n, once for power and once for the effect (the acceptance
// set). The references were generated with SciPy (scipy.stats.nct / ncf /
// ncx2 — independent implementations of the same math) and cross-checked
// against the published R pwr values where those are known (two-sample t
// n = 63.76561, one-sample t n = 33.36713, ANOVA n = 44.59927 all match
// exactly) and against hand-rolled Poisson-mixture series for the
// noncentral F / chi-square CDFs (see the generation log in
// ~/workspace/.helix-v183/fix-183-207-logs/). R pwr has no Welch test —
// the Welch pins are SciPy cross-checks (sd ratio 2), noted as such.
// Run: `node --import tsx tests/sample-size-power.ts` (also in `npm test`).
import { ok, rejects, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  centralChiSquareCdf,
  centralFCdf,
  centralTCdf,
  noncentralChiSquareCdf,
  noncentralFCdf,
  noncentralTCdf,
  normalCdf,
} from "../src/stats/distributions";
import {
  solveSampleSizePower,
  validateSampleSizeParams,
  type SampleSizeParams,
} from "../src/stats/sample-size-power";
import { executeJob } from "../src/store/mcp-dispatch";

/** 3 decimals: the pin passes when the value rounds to the reference. */
const close3 = (actual: number, expected: number) => Math.abs(actual - expected) < 0.0005;

const solve = (params: SampleSizeParams) => solveSampleSizePower(validateSampleSizeParams(params));

// ── Noncentral CDF identities (the series code paths, pinned against ──────
//    the central CDFs they must reduce to) ─────────────────────────────────
ok(Math.abs(noncentralTCdf(0, 10, 2) - normalCdf(-2)) < 1e-12, "nct(0; 10, 2) must equal Phi(-2)");
ok(Math.abs(noncentralTCdf(1.5, 10, 0) - centralTCdf(1.5, 10)) < 1e-12, "nct with delta 0 must equal central t");
ok(Math.abs(noncentralTCdf(-1.5, 10, 0) - centralTCdf(-1.5, 10)) < 1e-12, "nct(-t; 0) must equal central t");
ok(Math.abs(noncentralFCdf(2, 3, 20, 0) - centralFCdf(2, 3, 20)) < 1e-12, "ncf with lambda 0 must equal central F");
ok(
  Math.abs(noncentralChiSquareCdf(5, 4, 0) - centralChiSquareCdf(5, 4)) < 1e-12,
  "ncx2 with lambda 0 must equal central chi-square",
);
ok(Math.abs(normalCdf(0) - 0.5) < 1e-12, "Phi(0) = 0.5");
ok(Math.abs(normalCdf(1.959963984540054) - 0.975) < 1e-9, "Phi(1.959964) = 0.975");

// ── Two-sample t, equal variance (R pwr.t.test) ───────────────────────────
let r = solve({ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8 });
ok(close3(r.n, 63.76561), `two-sample t n: ${r.n} (want 63.76561)`);
strictEqual(r.nRounded, 64);
ok(r.powerAtRoundedN >= 0.8, "rounded n must reach the target power");
r = solve({ test: "two-sample-t", solveFor: "power", effect: 0.5, n: 64 });
ok(close3(r.power, 0.80146), `two-sample t power at n=64: ${r.power} (want 0.80146)`);
r = solve({ test: "two-sample-t", solveFor: "effect", n: 64, power: 0.8 });
ok(close3(r.effect, 0.49907), `two-sample t d at n=64: ${r.effect} (want 0.49907)`);
r = solve({ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8, alternative: "one-sided" });
ok(close3(r.n, 50.15078), `two-sample t one-sided n: ${r.n} (want 50.15078)`);

// ── One-sample t (R pwr.t.test, type = "one.sample") ──────────────────────
r = solve({ test: "one-sample-t", solveFor: "n", effect: 0.5, power: 0.8 });
ok(close3(r.n, 33.36713), `one-sample t n: ${r.n} (want 33.36713)`);
r = solve({ test: "one-sample-t", solveFor: "power", effect: 0.5, n: 34 });
ok(close3(r.power, 0.80778), `one-sample t power at n=34: ${r.power} (want 0.80778)`);
r = solve({ test: "one-sample-t", solveFor: "effect", n: 34, power: 0.8 });
ok(close3(r.effect, 0.49503), `one-sample t d at n=34: ${r.effect} (want 0.49503)`);

// ── Paired t (same math as one-sample: ncp = d·√n, df = n−1) ─────────────
r = solve({ test: "paired-t", solveFor: "n", effect: 0.5, power: 0.8 });
ok(close3(r.n, 33.36713), `paired t n: ${r.n} (want 33.36713)`);
r = solve({ test: "paired-t", solveFor: "power", effect: 0.5, n: 34 });
ok(close3(r.power, 0.80778), `paired t power at n=34: ${r.power} (want 0.80778)`);
r = solve({ test: "paired-t", solveFor: "effect", n: 34, power: 0.8 });
ok(close3(r.effect, 0.49503), `paired t d at n=34: ${r.effect} (want 0.49503)`);

// ── Two-sample t, Welch (SciPy cross-check; R pwr has no Welch) ──────────
r = solve({ test: "welch-t", solveFor: "n", effect: 0.5, power: 0.8, sdRatio: 2 });
ok(close3(r.n, 64.11592), `Welch t n (sd ratio 2): ${r.n} (want 64.11592)`);
r = solve({ test: "welch-t", solveFor: "power", effect: 0.5, n: 70, sdRatio: 2 });
ok(close3(r.power, 0.83397), `Welch t power at n=70: ${r.power} (want 0.83397)`);
r = solve({ test: "welch-t", solveFor: "effect", n: 70, power: 0.8, sdRatio: 2 });
ok(close3(r.effect, 0.47809), `Welch t d at n=70: ${r.effect} (want 0.47809)`);
// Welch with sd ratio 1 is the equal-variance test, exactly.
r = solve({ test: "welch-t", solveFor: "n", effect: 0.5, power: 0.8, sdRatio: 1 });
ok(close3(r.n, 63.76561), `Welch t (ratio 1) n: ${r.n} (want 63.76561)`);

// ── One-way ANOVA (R pwr.anova.test, k = 4) ──────────────────────────────
r = solve({ test: "one-way-anova", solveFor: "n", effect: 0.25, power: 0.8, groups: 4 });
ok(close3(r.n, 44.59927), `ANOVA n: ${r.n} (want 44.59927)`);
r = solve({ test: "one-way-anova", solveFor: "power", effect: 0.25, n: 45, groups: 4 });
ok(close3(r.power, 0.80399), `ANOVA power at n=45: ${r.power} (want 0.80399)`);
r = solve({ test: "one-way-anova", solveFor: "effect", n: 45, power: 0.8, groups: 4 });
ok(close3(r.effect, 0.24886), `ANOVA f at n=45: ${r.effect} (want 0.24886)`);

// ── Pearson correlation (R pwr.r.test, Fisher z) ──────────────────────────
r = solve({ test: "pearson-correlation", solveFor: "n", effect: 0.3, power: 0.8 });
ok(close3(r.n, 84.92761), `correlation n: ${r.n} (want 84.92761)`);
r = solve({ test: "pearson-correlation", solveFor: "power", effect: 0.3, n: 85 });
ok(close3(r.power, 0.80035), `correlation power at n=85: ${r.power} (want 0.80035)`);
r = solve({ test: "pearson-correlation", solveFor: "effect", n: 85, power: 0.8 });
ok(close3(r.effect, 0.29988), `correlation r at n=85: ${r.effect} (want 0.29988)`);

// ── One proportion (R pwr.p.test, Cohen's h) ──────────────────────────────
r = solve({ test: "one-proportion", solveFor: "n", effect: 0.5, power: 0.8 });
ok(close3(r.n, 31.39544), `one-proportion n: ${r.n} (want 31.39544)`);
r = solve({ test: "one-proportion", solveFor: "power", effect: 0.5, n: 32 });
ok(close3(r.power, 0.80743), `one-proportion power at n=32: ${r.power} (want 0.80743)`);
r = solve({ test: "one-proportion", solveFor: "effect", n: 32, power: 0.8 });
ok(close3(r.effect, 0.49525), `one-proportion h at n=32: ${r.effect} (want 0.49525)`);
// Proportions derive h: p0 = 0.5, p1 = 0.7 gives h = 2·asin√0.7 − 2·asin√0.5.
r = solve({ test: "one-proportion", solveFor: "n", p0: 0.5, p1: 0.7, power: 0.8 });
ok(close3(r.effect, 0.41152), `one-proportion h from p0/p1: ${r.effect} (want 0.41152)`);
ok(close3(r.n, 46.34804), `one-proportion n from p0/p1: ${r.n} (want 46.34804)`);

// ── Chi-square (R pwr.chisq.test): 2×2 (df = 1) + GOF (df = 3) ───────────
r = solve({ test: "chi-square", solveFor: "n", effect: 0.3, power: 0.8, chiSquareDf: 1 });
ok(close3(r.n, 87.20956), `chi-square (df 1) N: ${r.n} (want 87.20956)`);
r = solve({ test: "chi-square", solveFor: "power", effect: 0.3, n: 88, chiSquareDf: 1 });
ok(close3(r.power, 0.80353), `chi-square (df 1) power at N=88: ${r.power} (want 0.80353)`);
r = solve({ test: "chi-square", solveFor: "effect", n: 88, power: 0.8, chiSquareDf: 1 });
ok(close3(r.effect, 0.29865), `chi-square (df 1) w at N=88: ${r.effect} (want 0.29865)`);
r = solve({ test: "chi-square", solveFor: "n", effect: 0.3, power: 0.8, chiSquareDf: 3 });
ok(close3(r.n, 121.13959), `chi-square (df 3) N: ${r.n} (want 121.13959)`);
r = solve({ test: "chi-square", solveFor: "power", effect: 0.3, n: 120, chiSquareDf: 3 });
ok(close3(r.power, 0.79585), `chi-square (df 3) power at N=120: ${r.power} (want 0.79585)`);
r = solve({ test: "chi-square", solveFor: "effect", n: 120, power: 0.8, chiSquareDf: 3 });
ok(close3(r.effect, 0.30142), `chi-square (df 3) w at N=120: ${r.effect} (want 0.30142)`);
// GOF categories derive df: 4 categories → df 3, same answer as chiSquareDf 3.
r = solve({ test: "chi-square", solveFor: "n", effect: 0.3, power: 0.8, categories: 4 });
ok(close3(r.n, 121.13959), `chi-square (4 categories) N: ${r.n} (want 121.13959)`);

// ── Power curve: renders the solved value at the solved n ─────────────────
r = solve({ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8 });
ok(r.curve.n.length >= 20, "the curve needs enough points to draw");
ok(r.curve.n.length === r.curve.power.length, "curve n and power run together");
for (let i = 1; i < r.curve.power.length; i++) {
  ok(r.curve.power[i]! >= r.curve.power[i - 1]! - 1e-12, "power rises with n along the curve");
}
const atSolved = r.curve.n.indexOf(r.solvedN);
ok(atSolved >= 0, "the exact solved n is a curve point");
ok(Math.abs(r.curve.power[atSolved]! - 0.8) < 1e-6, "the curve matches the solved power at the solved n");
const spot: Record<number, number> = { 32: 0.50364, 48: 0.67884, 80: 0.8816, 96: 0.93144 };
for (const [n, power] of Object.entries(spot)) {
  const i = r.curve.n.indexOf(Number(n));
  ok(i >= 0, `curve must include n=${n}`);
  ok(close3(r.curve.power[i]!, power), `curve power at n=${n}: ${r.curve.power[i]} (want ${power})`);
}
ok(r.solvedN === r.n && Math.abs(r.solvedPower - 0.8) < 1e-9, "solved point carries the answer");

// ── Plain-language line ───────────────────────────────────────────────────
r = solve({ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8 });
ok(r.plainLanguage.includes("n = 64 per group"), `plain line names the rounded n: ${r.plainLanguage}`);
ok(r.plainLanguage.includes("d = 0.5"), "plain line names the effect");
ok(r.plainLanguage.includes("80% power"), "plain line names the power");
ok(r.plainLanguage.includes("α = 0.05"), "plain line names alpha");
r = solve({ test: "two-sample-t", solveFor: "power", effect: 0.5, n: 64 });
ok(r.plainLanguage.includes("80.1% power") || r.plainLanguage.includes("80.15% power"), `solve-power line: ${r.plainLanguage}`);
r = solve({ test: "one-way-anova", solveFor: "effect", n: 45, power: 0.8, groups: 4 });
ok(r.plainLanguage.includes("f = 0.249"), `solve-effect line: ${r.plainLanguage}`);

// ── Validation: bad inputs are errors, never made-up numbers ─────────────
const bad: [unknown, RegExp][] = [
  [{ test: "two-sample-t", solveFor: "n", effect: 0.5 }, /power/],
  [{ test: "two-sample-t", solveFor: "n", power: 0.8 }, /effect/],
  [{ test: "two-sample-t", solveFor: "power", effect: 0.5 }, /\bn\b/],
  [{ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8, alpha: 0 }, /alpha/],
  [{ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8, alpha: 1 }, /alpha/],
  [{ test: "two-sample-t", solveFor: "n", effect: -0.5, power: 0.8 }, /effect/],
  [{ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 1.5 }, /power/],
  [{ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8, n: 1 }, /n\b/],
  [{ test: "one-way-anova", solveFor: "n", effect: 0.25, power: 0.8, groups: 1 }, /groups/],
  [{ test: "one-way-anova", solveFor: "n", effect: 0.25, power: 0.8, groups: 2.5 }, /groups/],
  [{ test: "chi-square", solveFor: "n", effect: 0.3, power: 0.8 }, /df|degrees of freedom/],
  [{ test: "chi-square", solveFor: "n", effect: 0.3, power: 0.8, categories: 1 }, /categor/],
  [{ test: "pearson-correlation", solveFor: "n", effect: 1.5, power: 0.8 }, /effect|r\b/],
  [{ test: "welch-t", solveFor: "n", effect: 0.5, power: 0.8, sdRatio: 0 }, /SD ratio/],
  [{ test: "nope", solveFor: "n", effect: 0.5, power: 0.8 }, /test/],
  [{ test: "two-sample-t", solveFor: "sideways", effect: 0.5, power: 0.8 }, /solve/],
  [{ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8, alternative: "both" }, /alternative/],
  [{ test: "one-proportion", solveFor: "n", p0: 0.5, power: 0.8 }, /p1|proportion/],
  [{ test: "one-proportion", solveFor: "n", p0: 1.5, p1: 0.7, power: 0.8 }, /p0|proportion/],
];
for (const [params, pattern] of bad) {
  throws(() => validateSampleSizeParams(params), pattern, `bad params must throw: ${JSON.stringify(params)}`);
}

// ── JSON null means absent (Rust serializes omitted Options as null) ─────
// The live MCP path sends every omitted field as null (serde_json::json!
// on Option<T>), never undefined — the validator must treat null exactly
// like undefined, or the tool rejects its own documented minimal call
// (seq 207 Mac proof failure, Nov 23 2026: "alpha must be a number (got
// null)" on {test: two-sample-t, solve_for: n, effect: 0.5, power: 0.8}).
{
  const nullParams = validateSampleSizeParams({
    test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8,
    alpha: null, alternative: null, n: null, groups: null,
    chiSquareDf: null, categories: null, sdRatio: null, p0: null, p1: null,
  });
  strictEqual(nullParams.alpha, 0.05, "null alpha must default to 0.05");
  strictEqual(nullParams.alternative, "two-sided", "null alternative must default to two-sided");
  const nullSolved = solveSampleSizePower(nullParams);
  ok(close3(nullSolved.n, 63.76561), `null-payload n: ${nullSolved.n} (want 63.76561)`);
}

// ── MCP: the job returns the same numbers as the UI engine ────────────────
{
  const job = (args: unknown) =>
    ({ job_id: "j207", project_id: "p", action: "sample-size-power", args, status: "queued" }) as never;
  const deps = { getState: () => ({ nodes: {}, rootOrder: [], childOrder: {}, activeNodeId: null }) } as never;
  const out = await executeJob(
    job({ test: "two-sample-t", solve_for: "n", effect: 0.5, power: 0.8 }),
    deps,
  );
  const mcp = out.result as { n: number; power: number; plain_language: string; test: string };
  ok(close3(mcp.n, 63.76561), `MCP n: ${mcp.n} (want 63.76561)`);
  ok(mcp.plain_language.includes("n = 64 per group"), "MCP returns the plain-language line");
  strictEqual(mcp.test, "two-sample-t");
  const direct = solve({ test: "two-sample-t", solveFor: "n", effect: 0.5, power: 0.8 });
  strictEqual(mcp.n, direct.n, "MCP and UI must return the identical n (same engine)");
  strictEqual(mcp.power, direct.power, "MCP and UI must return the identical power");
  // The Rust dispatcher serializes omitted Options as JSON null — the live
  // MCP payload carries null for every omitted field. Same numbers as the
  // JS-shaped call, or the tool is unusable as documented (seq 207 proof
  // failure, Nov 23 2026).
  const nullMcp = await executeJob(
    job({ test: "two-sample-t", solve_for: "n", effect: 0.5, power: 0.8, alpha: null, alternative: null, n: null, groups: null, chi_square_df: null, categories: null, sd_ratio: null, p0: null, p1: null }),
    deps,
  );
  const nullResult = nullMcp.result as { n: number; power: number };
  ok(close3(nullResult.n, 63.76561), `MCP null-payload n: ${nullResult.n} (want 63.76561)`);
  strictEqual(nullResult.n, direct.n, "MCP null payload and UI must return the identical n");
  strictEqual(nullResult.power, direct.power, "MCP null payload and UI must return the identical power");
  // Bad MCP args reject, naming the problem.
  await rejects(
    executeJob(job({ test: "two-sample-t", solve_for: "n", effect: 0.5 }), deps),
    /power/,
  );
  await rejects(
    executeJob(job({ test: "two-sample-t", solve_for: "n", effect: 0.5, power: 0.8, alpha: 2 }), deps),
    /alpha/,
  );
  await rejects(executeJob(job({ test: "t-test", solve_for: "n", effect: 0.5, power: 0.8 }), deps), /test/);
}

// ── Wiring: menu (no project needed), selector, dialog, Rust, docs ───────
{
  const menu = readFileSync("src/app-menu.ts", "utf8");
  ok(menu.includes("Sample size & power…"), "Analysis menu must offer Sample size & power…");
  // The item opens the dialog with no table gate: its own block (text to
  // action) must carry no `enabled:` — unlike Simulate data… above it.
  const itemAt = menu.indexOf("Sample size & power…");
  const itemBlock = menu.slice(itemAt, itemAt + 200);
  ok(!itemBlock.includes("enabled:"), "Sample size & power… must not require a table");
  ok(itemBlock.includes('openSelector({ kind: "sample-size-power" })'), "menu must open the sample-size-power selector");
  const store = readFileSync("src/store/use-project-store.tsx", "utf8");
  ok(store.includes('{ kind: "sample-size-power" }'), "the store must carry the sample-size-power selector");
  const shell = readFileSync("src/components/app-shell.tsx", "utf8");
  ok(shell.includes("SampleSizePowerDialog"), "app-shell must render the dialog");
  const dialog = readFileSync("src/components/sample-size-power-dialog.tsx", "utf8");
  ok(dialog.includes("solveSampleSizePower"), "the dialog must run the engine");
  ok(dialog.includes("loadPlotly"), "the dialog must draw the power curve with Plotly");
  ok(dialog.includes("plainLanguage"), "the dialog must show the plain-language line");
  const mcp = readFileSync("src-tauri/src/mcp.rs", "utf8");
  ok(mcp.includes('name = "titer_sample_size_power"'), "Rust must register titer_sample_size_power");
  ok(mcp.includes("pub struct SampleSizePowerArgs"), "Rust must take sample-size-power args");
  ok(mcp.includes('"sample-size-power"'), "Rust must enqueue the sample-size-power job");
  ok(mcp.includes('"titer_sample_size_power",'), "the analyses allowlist group must include the new tool");
  ok(mcp.includes("assert_eq!(all.len(), 78,"), "the inventory pin must count 78 tools");
  ok(mcp.includes("assert_eq!(tools.len(), 78,"), "the tool-count pin must count 78 tools");
  ok(mcp.includes("fourteen analysis tools (incl. three job tools)"), "the smoke-test breakdown must count fourteen analysis tools");
  const dispatch = readFileSync("src/store/mcp-dispatch.ts", "utf8");
  ok(dispatch.includes('case "sample-size-power":'), "the dispatcher must route sample-size-power");
  const coverage = readFileSync("tests/mcp-coverage-180.ts", "utf8");
  ok(coverage.includes("EXPECTED_TOOL_COUNT = 78"), "the coverage gate must expect 78 tools");
  const contract = readFileSync("docs/mcp-server-contract.md", "utf8");
  ok(contract.includes("titer_sample_size_power"), "the MCP contract must document the tool");
  ok(contract.includes("78 tools"), "the MCP contract must count 78 tools");
  const engine = readFileSync("src/stats/sample-size-power.ts", "utf8");
  ok(engine.includes("noncentralTCdf") || engine.includes("noncentral"), "the engine must use the noncentral CDFs");
  const dists = readFileSync("src/stats/distributions.ts", "utf8");
  ok(dists.includes("export function noncentralTCdf"), "distributions must export the noncentral t CDF");
  ok(dists.includes("export function noncentralFCdf"), "distributions must export the noncentral F CDF");
  ok(dists.includes("export function noncentralChiSquareCdf"), "distributions must export the noncentral chi-square CDF");
  // No Cloud anywhere in this tool: the computation is local by decision.
  ok(!/fetch\(|XMLHttpRequest|WebSocket|https?:\/\//.test(engine), "the engine must not touch the network");
}

console.log("All sample-size-power checks pass.");
